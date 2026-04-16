import { loadAllChainReports, loadLatestChainReport } from '../chain-reports.js';

export function readChainReportSnapshot(workspacePath, { limit } = {}) {
  const reports = loadAllChainReports(workspacePath);
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : reports.length;

  return {
    ok: true,
    status: 200,
    body: {
      latest: loadLatestChainReport(workspacePath),
      reports: reports.slice(0, effectiveLimit),
    },
  };
}
