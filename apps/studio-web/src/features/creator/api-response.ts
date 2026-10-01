export async function readApiResponse<T>(
  response: Response,
  errorMessages: Record<string, string> = {},
): Promise<T> {
  const text = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      response.status >= 500
        ? '服务暂时没有响应，请稍后重试。你的输入已保留。'
        : '服务返回了不完整的内容，请重试。你的输入已保留。',
    );
  }
  if (!response.ok) {
    const code =
      result && typeof result === 'object' && 'code' in result
        ? String(result.code)
        : '';
    throw new Error(
      errorMessages[code] ??
        (response.status >= 500
          ? '服务暂时没有响应，请稍后重试。你的输入已保留。'
          : `请求失败（${response.status}），请稍后重试。`),
    );
  }
  if (result === null || typeof result !== 'object') {
    throw new Error('服务返回了不完整的内容，请重试。你的输入已保留。');
  }
  return result as T;
}
