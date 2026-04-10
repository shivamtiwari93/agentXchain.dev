export declare class GovernedNotificationService {
    private previous;
    private root;
    private disposed;
    constructor(root: string);
    check(): Promise<void>;
    dispose(): void;
}
