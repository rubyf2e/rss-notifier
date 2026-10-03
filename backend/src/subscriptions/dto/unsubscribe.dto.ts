import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{64}$/)
  token!: string;
}