import { File } from 'expo-file-system';

export async function readVoiceRecording(uri: string): Promise<{ dataUrl: string; mimeType: string }> {
  const mimeType = /\.(m4a|mp4)$/i.test(uri) ? 'audio/mp4'
    : /\.aac$/i.test(uri) ? 'audio/aac' : /\.wav$/i.test(uri) ? 'audio/wav' : 'audio/webm';
  return { dataUrl: `data:${mimeType};base64,${await new File(uri).base64()}`, mimeType };
}

export function releaseVoiceRecording(uri: string): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The recorder may have released its temporary file already.
  }
}
