import { downloadBlobFile } from '../shared/downloadFile'

/** Save a JSON array through the browser download prompt. */
export function downloadJson(filename: string, value: unknown): void {
  downloadBlobFile(`${JSON.stringify(value, null, 2)}\n`, filename)
}
