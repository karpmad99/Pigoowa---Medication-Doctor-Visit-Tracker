/** The ids that tie a tab to its panel, so a panel can name itself after its tab. */
export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const tabPanelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;
