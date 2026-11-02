import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import type { PlatformGraphqlContext } from '../../graphql/graphql-context';
import { DeviceEnrollmentService } from './device-enrollment.service';
import {
  AdminDevicesInput,
  ConfirmDevicePairingInput,
  CreateDevicePairingInput,
  DevicePage,
  DevicePairing,
  DevicesInput,
  EnrolledDevice,
  RevokeDeviceInput,
} from './dto/device.dto';

@Resolver()
export class DeviceEnrollmentResolver {
  constructor(private readonly devices: DeviceEnrollmentService) {}

  @Query(() => DevicePage)
  myDevices(
    @Args('input') input: DevicesInput,
    @Context() { req }: PlatformGraphqlContext,
  ) {
    return this.devices.list(req.account.user._id, input);
  }
  @Query(() => EnrolledDevice, { nullable: true })
  currentDevice(@Context() { req }: PlatformGraphqlContext) {
    return this.devices.current(req.account.deviceId, req.account.user._id);
  }
  @UseGuards(GraphqlAdminGuard)
  @Query(() => DevicePage)
  adminDevices(@Args('input') input: AdminDevicesInput) {
    return this.devices.list(input.userId, input);
  }
  @Mutation(() => DevicePairing)
  createDevicePairing(
    @Args('input') input: CreateDevicePairingInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.devices.createPairing(
      input,
      ctx.credential,
      ctx.req.authTransport,
    );
  }
  @Mutation(() => EnrolledDevice)
  confirmDevicePairing(
    @Args('input') input: ConfirmDevicePairingInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.devices.confirmPairing(
      input.code,
      ctx.credential,
      ctx.req.authTransport,
    );
  }
  @Mutation(() => EnrolledDevice)
  revokeDevice(
    @Args('input') input: RevokeDeviceInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.devices.revoke(input.id, ctx.credential, ctx.req.authTransport);
  }
  @UseGuards(GraphqlAdminGuard)
  @Mutation(() => EnrolledDevice)
  adminRevokeDevice(
    @Args('input') input: RevokeDeviceInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.devices.revoke(
      input.id,
      ctx.credential,
      ctx.req.authTransport,
      true,
    );
  }
}
