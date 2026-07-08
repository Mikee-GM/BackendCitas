import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateLoyaltyTierDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  readonly code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  readonly name: string;

  @IsNumber()
  @Min(0)
  readonly minSpend: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  readonly earnRate?: number;

  @IsBoolean()
  @IsOptional()
  readonly active?: boolean;

  @IsInt()
  @IsOptional()
  readonly sortOrder?: number;
}
