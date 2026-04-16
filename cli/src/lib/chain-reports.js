import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export function getChainReportsDir(root) {
  return join(root, '.agentxchain', 'reports');
}

export function loadAllChainReports(root) {
  const reportsDir = getChainReportsDir(root);
  if (!existsSync(reportsDir)) return [];

  const files = readdirSync(reportsDir)
    .filter((file) => file.startsWith('chain-') && file.endsWith('.json'))
    .sort()
    .reverse();

  const reports = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(reportsDir, file), 'utf8');
      reports.push(JSON.parse(content));
    } catch {
      // Advisory artifact only. Skip malformed files instead of failing the surface.
    }
  }

  reports.sort((a, b) => {
    const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
    const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
    return bTime - aTime;
  });

  return reports;
}

export function loadLatestChainReport(root) {
  const reports = loadAllChainReports(root);
  return reports.length > 0 ? reports[0] : null;
}

export function loadChainReport(root, chainId) {
  const reportsDir = getChainReportsDir(root);
  const exactPath = join(reportsDir, `${chainId}.json`);
  if (existsSync(exactPath)) {
    try {
      return JSON.parse(readFileSync(exactPath, 'utf8'));
    } catch {
      return null;
    }
  }

  const reports = loadAllChainReports(root);
  return reports.find((report) => report.chain_id === chainId) || null;
}
