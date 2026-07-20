import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export const PROMOTION_TONES = ['coqueta', 'cachonda', 'juguetona'] as const;
export type PromotionTone = (typeof PROMOTION_TONES)[number];

export class PromotionFiltersDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  membershipTierCodes?: string[];
  @IsOptional() @IsInt() @Min(0) minPreviousServices?: number;
  @IsOptional() @IsInt() @Min(0) inactiveDays?: number;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) clientIds?: string[];
  @IsOptional() @IsInt() @Min(0) excludePromotedWithinDays?: number;
}

export class PromotionRequestDto {
  @IsString() offer: string;
  @IsOptional()
  @IsIn(PROMOTION_TONES)
  tone?: PromotionTone;
  @IsOptional() filters?: PromotionFiltersDto;
}
