import { PartialType } from '@nestjs/mapped-types';
import { CreateServiceExtraDto } from './create-service-extra.dto';

export class UpdateServiceExtraDto extends PartialType(CreateServiceExtraDto) {}
