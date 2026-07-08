import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class SetClientTierDto {
  @IsUUID()
  @IsOptional()
  readonly tierId?: string;

  @IsString()
  @IsOptional()
  readonly tierCode?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  readonly notes?: string;
}
