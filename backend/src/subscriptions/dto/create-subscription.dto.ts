import { IsNotEmpty, IsUrl } from 'class-validator';

export class CreateSubscriptionDto {
  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string;
}