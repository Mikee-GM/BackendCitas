import { PartialType } from '@nestjs/mapped-types';
import { CreateLoyaltyTierDto } from './create-loyalty-tier.dto';

export class UpdateLoyaltyTierDto extends PartialType(CreateLoyaltyTierDto) {}
