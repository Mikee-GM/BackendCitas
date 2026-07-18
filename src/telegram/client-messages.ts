type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia';

const paymentLabel = (method: PaymentMethod) => method.toUpperCase();

export const clientMessages = {
  paymentAndLocation: (duration: number, payment: PaymentMethod) =>
    `✨ *Perfecto, ya quedó anotado: ${duration} horas y pago con ${paymentLabel(payment)}.*\n\n` +
    `Ahora sí, compárteme tu ubicación con el botón de abajo para poder llegar contigo.`,

  locationRequest: () =>
    `📍 *Ya casi terminamos.*\n\nCompárteme tu ubicación con el botón de abajo para dejar todo listo y poder llegar contigo.`,

  bookingConfirmed: (params: {
    duration: number;
    payment: PaymentMethod;
    hourlyRate: number | string;
    location?: string | null;
  }) =>
    `✨ *Ya dejé anotado nuestro servicio.*\n\n` +
    `• *Duración:* ${params.duration} horas\n` +
    `• *Pago:* ${paymentLabel(params.payment)}\n` +
    `• *Tarifa:* $${params.hourlyRate}/hr\n` +
    (params.location ? `• *Ubicación:* ${params.location}\n` : '') +
    `\nEn cuanto quede confirmado, te aviso para ponernos de acuerdo.`,

  chainedBookingConfirmed: (params: {
    duration: number;
    payment: PaymentMethod;
    hourlyRate: number | string;
    estimatedStart: string;
    location?: string | null;
  }) =>
    `📅 *Ya dejé apartada nuestra cita.*\n\n` +
    `• *Duración:* ${params.duration} horas\n` +
    `• *Pago:* ${paymentLabel(params.payment)}\n` +
    `• *Tarifa:* $${params.hourlyRate}/hr\n` +
    `• *Hora aproximada:* ${params.estimatedStart}\n` +
    (params.location ? `• *Ubicación:* ${params.location}\n` : '') +
    `\nApenas termine lo que estoy haciendo, te aviso cuando ya esté lista para ir contigo.`,

  onTheWay: (employeeName: string, driverName: string) =>
    `🚗 *Ya voy en camino contigo.*\n\nSoy *${employeeName}*; el chofer *${driverName}* ya me recogió y vamos rumbo a tu ubicación.`,

  arrived: (employeeName: string) =>
    `📍 *Ya llegué.*\n\nSoy *${employeeName}* y ya estoy en tu ubicación para comenzar.`,

  chainedTurnActive: (employeeName: string) =>
    `✨ *Ya terminé mi servicio anterior.*\n\nSoy *${employeeName}* y tu turno ya está activo. En cuanto quede confirmado, te aviso para ir contigo.`,

  chainedTimeUpdated: (employeeName: string, estimatedStart: string) =>
    `⏳ *Te aviso de mi horario.*\n\nSoy *${employeeName}* y voy a tardar un poquito más con mi servicio actual. Ahora calculo estar lista cerca de las *${estimatedStart}*.`,
};
