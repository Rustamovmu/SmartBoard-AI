import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DatabaseModule } from '../../database/database.module';
import { MembersService } from './members.service';
import { MEMBER_MODEL, MemberSchema } from './schemas/member.schema';

@Module({
  imports: [
    DatabaseModule,
    MongooseModule.forFeature([{ name: MEMBER_MODEL, schema: MemberSchema }]),
  ],
  providers: [MembersService],
  exports: [MembersService, MongooseModule],
})
export class MembersModule {}
