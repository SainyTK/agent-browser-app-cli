export interface BrowserTab {
  active: boolean;
  label: string | null;
  tabId: string;
  title: string;
  type: string;
  url: string;
}

export interface BrowserSession {
  readonly sessionName: string;
  open(url: string, headed?: boolean): Promise<void>;
  currentUrl(): Promise<string>;
  attach(cdpPort: number): Promise<void>;
  listTabs(): Promise<BrowserTab[]>;
  switchTab(tabId: string): Promise<void>;
  eval<T>(script: string): Promise<T>;
  evalInFrame<T>(frameUrlIncludes: string, script: string): Promise<T>;
  fillInFrame(frameUrlIncludes: string, selector: string, value: string, pressEnter?: boolean): Promise<boolean>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(key: string): Promise<void>;
  uploadFilesThroughFileChooser(triggerSelector: string, filePaths: string[]): Promise<void>;
  saveState(): Promise<void>;
  close(): Promise<void>;
}
