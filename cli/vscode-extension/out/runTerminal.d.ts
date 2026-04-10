import { GovernedRunAction } from './governedStatus';
export declare function hasActiveGovernedRunTerminal(): boolean;
export declare function launchGovernedRunTerminal(root: string, action: GovernedRunAction): 'launched' | 'reused';
