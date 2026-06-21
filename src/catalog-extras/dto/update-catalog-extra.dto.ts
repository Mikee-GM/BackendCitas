import { PartialType } from '@nestjs/mapped-types';
import { CreateCatalogExtraDto } from './create-catalog-extra.dto';

export class UpdateCatalogExtraDto extends PartialType(CreateCatalogExtraDto) {}
