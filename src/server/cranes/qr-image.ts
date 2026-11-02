import QRCode from 'qrcode'

/**
 * Renders a QR code as an inline SVG string.
 *
 * SVG rather than PNG so the label stays sharp at any printer resolution and needs no image route or
 * storage round-trip: the label page embeds the markup directly. Rendering happens on the server, so
 * the print page also works with JavaScript disabled — which matters when the only available machine
 * is the one behind the stores counter.
 */
export async function qrSvg(payload: string, sizePx = 220): Promise<string> {
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: sizePx,
    color: { dark: '#000000', light: '#ffffff' },
  })
}
