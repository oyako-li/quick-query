export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Rect = Point & Size

const OFFSET = 14

/** カーソルの右下に置く。はみ出す辺はカーソルの反対側へ反転し、最後に workArea 内へクランプする */
export function computePopupPosition(cursor: Point, size: Size, workArea: Rect): Point {
  let x = cursor.x + OFFSET
  let y = cursor.y + OFFSET
  if (x + size.width > workArea.x + workArea.width) x = cursor.x - OFFSET - size.width
  if (y + size.height > workArea.y + workArea.height) y = cursor.y - OFFSET - size.height
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - size.width))
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - size.height))
  return { x: Math.round(x), y: Math.round(y) }
}
