import { BadRequestException, ConflictException } from '@nestjs/common';
import { ServicesService } from './services.service';

describe('ServicesService transport settlement', () => {
  const serviciosRepository = {
    update: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
  };
  const viajesRepository = {
    update: jest.fn(),
    findOne: jest.fn(),
  };
  const usuariosRepository = { findOneBy: jest.fn() };
  const realtime = {
    emitToJefes: jest.fn(),
    emitToBoss: jest.fn(),
    emitToClient: jest.fn(),
    emitToEmployee: jest.fn(),
  };
  const bot = {
    telegram: {
      sendMessage: jest.fn(),
      editMessageText: jest.fn(),
    },
  };
  const loyalty = { awardForFinalizedService: jest.fn() };

  const service = new ServicesService(
    serviciosRepository as any,
    viajesRepository as any,
    {} as any,
    usuariosRepository as any,
    realtime as any,
    bot as any,
    {} as any,
    {} as any,
    loyalty as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rechaza una tarifa inválida sin modificar el viaje', async () => {
    await expect(
      service.confirmUberFare('trip', 'boss', 0),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(viajesRepository.update).not.toHaveBeenCalled();
  });

  it('reemplaza la tarifa del regreso y cierra la liquidación', async () => {
    viajesRepository.findOne.mockResolvedValue({
      id: 'trip',
      tipo: 'regreso',
      servicioId: 'service',
      proveedorTransporte: 'uber',
      servicio: { jefeId: 'boss', empleada: { usuario: {} } },
    });
    usuariosRepository.findOneBy.mockResolvedValue({ id: 'boss', rol: 'jefe' });
    serviciosRepository.findOneBy.mockResolvedValue({
      totalTransporte: 235.5,
      totalFinal: 1235.5,
    });
    jest.spyOn(service, 'sendFinalReceiptAndAward').mockResolvedValue();

    await service.confirmUberFare('trip', 'boss', 185.5);

    expect(viajesRepository.update).toHaveBeenCalledWith('trip', {
      tarifa: 185.5,
    });
    expect(serviciosRepository.update).toHaveBeenCalledWith('service', {
      estadoLiquidacion: 'cerrada',
    });
    expect(service.sendFinalReceiptAndAward).toHaveBeenCalledWith('service');
  });

  it('impide que otra empleada actualice el estado del Uber', async () => {
    viajesRepository.findOne.mockResolvedValue({
      id: 'trip',
      estado: 'llegado',
      proveedorTransporte: 'uber',
      servicio: {
        jefeId: 'boss',
        empleada: { usuarioId: 'assigned-user', usuario: {} },
      },
    });
    usuariosRepository.findOneBy.mockResolvedValue({
      id: 'other-user',
      rol: 'empleada',
    });

    await expect(
      service.updateUberStatus('trip', 'other-user', 'employee_en_route'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(viajesRepository.update).not.toHaveBeenCalled();
  });

  it('permite al jefe marcar que el Uber llegó sin depender del estado previo', async () => {
    viajesRepository.findOne.mockResolvedValue({
      id: 'trip',
      estado: 'notificado',
      proveedorTransporte: 'uber',
      servicioId: 'service',
      servicio: {
        jefeId: 'boss',
        empleadaId: 'employee',
        empleada: { usuario: { telegramChatId: '123' } },
      },
    });
    usuariosRepository.findOneBy.mockResolvedValue({
      id: 'boss',
      rol: 'jefe',
    });

    await service.updateUberStatus('trip', 'boss', 'uber_arrived');

    expect(viajesRepository.update).toHaveBeenCalledWith('trip', {
      estado: 'llegado',
    });
    const keyboard = bot.telegram.sendMessage.mock.calls[0][2];
    const callbackData =
      keyboard.reply_markup.inline_keyboard[0][0].callback_data;
    expect(Buffer.byteLength(callbackData, 'utf8')).toBeLessThanOrEqual(64);
  });
});
