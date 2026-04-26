export {};

declare global {
  interface Window {
    electronAPI: {
      saveAnimation(filename: string, html_content: string): Promise<{ success: boolean; filename: string; path: string; error?: string }>;
      readAnimation(filename: string): Promise<{ success: boolean; content: string; error?: string }>;
      listAnimations(): Promise<{ success: boolean; files: string[]; error?: string }>;
      openInBrowser(filename: string): Promise<{ success: boolean; error?: string }>;
    };
  }
}
