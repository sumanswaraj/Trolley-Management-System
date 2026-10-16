import QRCode from 'qrcode';
import { fail } from '../errors.mjs';

export function labelService(repository) {
  return {
    async svg(trolleyId) {
      const trolley = repository.get('SELECT id, qr_value FROM trolleys WHERE id = ?', trolleyId);
      if (!trolley) fail(404, 'Trolley not found');
      return QRCode.toString(trolley.qr_value || trolley.id, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 4,
        width: 320,
      });
    },
  };
}
