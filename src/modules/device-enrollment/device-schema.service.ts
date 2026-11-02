import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { DEVICE_MODEL, Device } from './schemas/device.schema';
import {
  PAIRING_MODEL,
  PairingRequest,
} from './schemas/pairing-request.schema';

@Injectable()
export class DeviceSchemaService {
  constructor(
    @InjectModel(DEVICE_MODEL) private readonly devices: Model<Device>,
    @InjectModel(PAIRING_MODEL)
    private readonly pairings: Model<PairingRequest>,
  ) {}

  async assertPrepared() {
    try {
      const [devices, pairings] = await Promise.all([
        this.devices.listIndexes(),
        this.pairings.listIndexes(),
      ]);
      if (
        !devices.some(
          (i) =>
            i.key.userId === 1 &&
            i.key.status === 1 &&
            i.key.createdAt === -1 &&
            i.key._id === 1 &&
            Object.keys(i.key).length === 4,
        ) ||
        !pairings.some(
          (i) =>
            i.unique === true &&
            i.key.codeHash === 1 &&
            Object.keys(i.key).length === 1,
        ) ||
        !pairings.some(
          (i) =>
            i.key.expiresAt === 1 &&
            Object.keys(i.key).length === 1 &&
            i.expireAfterSeconds === 0,
        )
      )
        throw new Error();
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  /** Explicit operator/test setup only; does not synchronize or drop indexes. */
  async prepare() {
    await this.devices.createCollection();
    await this.devices.createIndexes();
    await this.pairings.createCollection();
    await this.pairings.createIndexes();
    await this.assertPrepared();
  }
}
