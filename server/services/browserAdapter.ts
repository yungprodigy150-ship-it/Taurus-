import dns from 'node:dns/promises';
import net from 'node:net';
import { getIntegrationRow, parseIntegrationConfig } from './aiProvider.ts';
import { logEvent } from './logger.ts';

export interface BrowserInspectionResult {
  url: string;
  finalUrl: string;
  mode: 'remote_cdp_browser' | 'http_dom_fetch';
  statusCode: number;
  title: string;
  metaDescription: string;
  headings: string[];
  linksCount: number;
  textExcerpt: string;
  fetchedAt: string;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return true;
}

async function assertPublicSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL provided for browser inspection.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are permitted.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Localhost and internal hostnames are blocked.');
  }

  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error('Private IP addresses are blocked.');
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        throw new Error('Target domain resolves to a private or restricted IP range.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('blocked') || (err instanceof Error && err.message.includes('private'))) {
      throw err;
    }
    throw new Error(`DNS lookup failed for ${hostname}.`);
  }

  return parsed;
}

function extractHtmlSummary(html: string): {
  title: string;
  metaDescription: string;
  headings: string[];
  linksCount: number;
  textExcerpt: string;
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const metaDescription = descMatch ? descMatch[1].trim() : '';

  const headings: string[] = [];
  const hRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let match: RegExpExecArray | null;
  while ((match = hRegex.exec(html)) !== null && headings.length < 10) {
    const clean = match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (clean) headings.push(clean.slice(0, 120));
  }

  const linksCount = (html.match(/<a\s+[^>]*href=/gi) || []).length;

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title,
    metaDescription,
    headings,
    linksCount,
    textExcerpt: stripped.slice(0, 2500),
  };
}

async function inspectViaRemoteCdp(cdpBaseUrl: string, targetUrl: string): Promise<BrowserInspectionResult> {
  // Create a new CDP target tab via /json/new?<url>, evaluate DOM via HTTP/WebSocket if available
  const base = cdpBaseUrl.replace(/\/$/, '');
  const versionRes = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(5000) });
  if (!versionRes.ok) {
    throw new Error(`Remote CDP endpoint unavailable (HTTP ${versionRes.status}).`);
  }

  // Open target tab in remote Chromium
  const newTabRes = await fetch(`${base}/json/new?${encodeURIComponent(targetUrl)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(8000),
  });
  if (!newTabRes.ok) {
    throw new Error(`Remote Chromium failed to open target page (HTTP ${newTabRes.status}).`);
  }

  const tabInfo = (await newTabRes.json()) as { id?: string; webSocketDebuggerUrl?: string; title?: string; url?: string };

  // Give page brief render settle and inspect via native WebSocket if Node 22 global WebSocket exists
  let html = '';
  if (tabInfo.webSocketDebuggerUrl && typeof WebSocket !== 'undefined') {
    await new Promise((r) => setTimeout(r, 1500));
    html = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(tabInfo.webSocketDebuggerUrl!);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error('CDP DOM evaluation timed out.'));
      }, 8000);

      ws.addEventListener('open', () => {
        ws.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression: 'document.documentElement.outerHTML', returnByValue: true },
          })
        );
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            id?: number;
            result?: { result?: { value?: string } };
          };
          if (msg.id === 1) {
            clearTimeout(timer);
            ws.close();
            resolve(msg.result?.result?.value || '');
          }
        } catch {
          // wait for matching response
        }
      });

      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket connection error.'));
      });
    });
  }

  if (tabInfo.id) {
    await fetch(`${base}/json/close/${tabInfo.id}`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  }

  const parsed = extractHtmlSummary(html || `<title>${tabInfo.title || ''}</title>`);
  return {
    url: targetUrl,
    finalUrl: tabInfo.url || targetUrl,
    mode: 'remote_cdp_browser',
    statusCode: 200,
    title: parsed.title || tabInfo.title || targetUrl,
    metaDescription: parsed.metaDescription,
    headings: parsed.headings,
    linksCount: parsed.linksCount,
    textExcerpt: parsed.textExcerpt,
    fetchedAt: new Date().toISOString(),
  };
}

export async function inspectWebPage(
  rawUrl: string,
  actorId?: string,
  actorName?: string
): Promise<BrowserInspectionResult> {
  const safeUrl = await assertPublicSafeUrl(rawUrl);

  const browserRow = getIntegrationRow('browser_automation');
  const config = browserRow ? parseIntegrationConfig(browserRow) : {};
  const cdpEndpoint = config.endpointUrl?.trim();

  if (browserRow?.connection_status === 'connected' && cdpEndpoint) {
    const result = await inspectViaRemoteCdp(cdpEndpoint, safeUrl.toString());
    logEvent({
      level: 'success',
      subsystem: 'ATLAS',
      action: 'browser.cdp_inspected',
      message: `Inspected ${safeUrl.toString()} via remote Chromium CDP browser.`,
      actorId,
      actorName,
    });
    return result;
  }

  // Genuine HTTP DOM Fetch Adapter (explicitly marked non-JS HTTP mode)
  const res = await fetch(safeUrl.toString(), {
    headers: {
      'User-Agent': 'Taurus-Atlas-Inspector/2.0',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`HTTP request to ${safeUrl.hostname} returned status ${res.status}.`);
  }

  const contentType = res.headers.get('content-type') || '';
  const body = await res.text();
  const isHtml = contentType.includes('html') || body.trimStart().startsWith('<');
  const summary = isHtml
    ? extractHtmlSummary(body)
    : {
        title: safeUrl.hostname,
        metaDescription: '',
        headings: [],
        linksCount: 0,
        textExcerpt: body.slice(0, 2500),
      };

  logEvent({
    level: 'info',
    subsystem: 'ATLAS',
    action: 'browser.http_inspected',
    message: `Fetched public URL ${safeUrl.toString()} via HTTP DOM Fetch Adapter (HTTP ${res.status}).`,
    actorId,
    actorName,
  });

  return {
    url: safeUrl.toString(),
    finalUrl: res.url || safeUrl.toString(),
    mode: 'http_dom_fetch',
    statusCode: res.status,
    title: summary.title || safeUrl.hostname,
    metaDescription: summary.metaDescription,
    headings: summary.headings,
    linksCount: summary.linksCount,
    textExcerpt: summary.textExcerpt,
    fetchedAt: new Date().toISOString(),
  };
}
