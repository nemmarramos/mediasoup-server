import { Module } from '@nestjs/common';
import { WssGateway } from './wss.gateway';

@Module({
  providers: [WssGateway],
})
export class WssModule {}