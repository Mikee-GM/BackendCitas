import { OfficeLiquidationSyncService } from './office-liquidation-sync.service';

describe('OfficeLiquidationSyncService', () => {
  const services = { findOne: jest.fn() };
  const records = { upsert: jest.fn(), findOneOrFail: jest.fn() };
  const cashObligations = { findOneBy: jest.fn(), upsert: jest.fn() };
  const sync = new OfficeLiquidationSyncService(
    services as any,
    records as any,
    cashObligations as any,
  );

  beforeEach(() => jest.clearAllMocks());

  function finalized(overrides: Record<string, unknown> = {}) {
    return {
      id: 'service',
      estado: 'finalizado',
      horaFinServicio: new Date('2026-07-18T20:00:00Z'),
      empleadaId: 'employee',
      jefeId: 'boss',
      jefe: { rol: 'jefe' },
      metodoPago: 'efectivo',
      totalBase: 2500,
      totalExtras: 1000,
      totalTransporte: 120,
      totalFinal: 2620,
      viajes: [
        { tipo: 'ida', proveedorTransporte: 'interno' },
        { tipo: 'regreso', proveedorTransporte: 'uber' },
      ],
      ...overrides,
    };
  }

  it('no registra servicios que todavía no finalizaron', async () => {
    services.findOne.mockResolvedValue(finalized({ estado: 'en_curso' }));

    await expect(sync.syncOfficeRecord('service')).resolves.toBeNull();
    expect(records.upsert).not.toHaveBeenCalled();
  });

  it('separa el corte semanal de la entrega física de efectivo', async () => {
    services.findOne.mockResolvedValue(finalized());
    records.findOneOrFail.mockResolvedValue({ id: 'record' });

    await sync.syncOfficeRecord('service');

    expect(records.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'service',
        serviceTotal: 2500,
        extraAmount: 1000,
        companyTransportExpense: 0,
        customerTransportCharge: 120,
        employeeCashDue: 2620,
        cashAmount: 2500,
        cardAmounts: [],
        hasOutboundDriver: true,
        hasReturnDriver: false,
      }),
      expect.objectContaining({ conflictPaths: ['serviceId'] }),
    );
  });

  it.each(['tarjeta', 'transferencia'])(
    'trata %s como pago electrónico',
    async (paymentMethod) => {
      services.findOne.mockResolvedValue(
        finalized({ metodoPago: paymentMethod }),
      );
      records.findOneOrFail.mockResolvedValue({ id: 'record' });

      await sync.syncOfficeRecord('service');

      expect(records.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ cashAmount: 0, cardAmounts: [2500] }),
        expect.anything(),
      );
    },
  );

  it('exige entregar el total final cuando no hubo Uber', async () => {
    services.findOne.mockResolvedValue(
      finalized({
        totalBase: 5000,
        totalFinal: 5000,
        viajes: [
          { tipo: 'ida', proveedorTransporte: 'interno', estado: 'finalizado' },
          {
            tipo: 'regreso',
            proveedorTransporte: 'interno',
            estado: 'finalizado',
          },
        ],
      }),
    );
    records.findOneOrFail.mockResolvedValue({ id: 'record' });

    await sync.syncOfficeRecord('service');

    expect(cashObligations.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        uberDeduction: 0,
        calculationStatus: 'ready',
      }),
      ['serviceId'],
    );
  });

  it('descuenta únicamente las tarifas de Uber confirmadas', async () => {
    services.findOne.mockResolvedValue(
      finalized({
        totalBase: 5000,
        totalFinal: 5000,
        viajes: [
          {
            tipo: 'ida',
            proveedorTransporte: 'uber',
            estado: 'finalizado',
            tarifa: 180,
            fareConfirmedAt: new Date(),
          },
          {
            tipo: 'regreso',
            proveedorTransporte: 'uber',
            estado: 'finalizado',
            tarifa: 220,
            fareConfirmedAt: new Date(),
          },
        ],
      }),
    );
    records.findOneOrFail.mockResolvedValue({ id: 'record' });

    await sync.syncOfficeRecord('service');

    expect(cashObligations.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 4600,
        uberDeduction: 400,
        calculationStatus: 'ready',
      }),
      ['serviceId'],
    );
  });

  it('repite el upsert por serviceId sin insertar por otra llave', async () => {
    services.findOne.mockResolvedValue(finalized());
    records.findOneOrFail.mockResolvedValue({ id: 'record' });

    await sync.syncOfficeRecord('service');
    await sync.syncOfficeRecord('service');

    expect(records.upsert).toHaveBeenCalledTimes(2);
    expect(records.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ serviceId: 'service' }),
      expect.objectContaining({ conflictPaths: ['serviceId'] }),
    );
  });
});
