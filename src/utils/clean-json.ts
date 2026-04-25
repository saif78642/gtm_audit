export function cleanGtmJsonString(originalContent: string): string {
  if (!originalContent) return originalContent;
  
  // Replace all control characters (0-31, 127-159) except for newlines, carriage returns, and tabs
  return originalContent.replace(/[\x00-\x1F\x7F-\x9F]/g, char => {
    if (['\n', '\r', '\t'].includes(char)) return char;
    return '';
  });
}
