import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DEVICE_MODEL, DeviceSchema } from './schemas/device.schema';
import {
  PAIRING_MODEL,
  PairingRequestSchema,
} from './schemas/pairing-request.schema';
import { DeviceSchemaService } from './device-schema.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DEVICE_MODEL, schema: DeviceSchema },
      { name: PAIRING_MODEL, schema: PairingRequestSchema },
    ]),
  ],
  providers: [DeviceSchemaService],
  exports: [MongooseModule, DeviceSchemaService],
})
export class DeviceRecordsModule {}
