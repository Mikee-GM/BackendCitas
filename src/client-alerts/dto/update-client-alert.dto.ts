import { PartialType } from '@nestjs/mapped-types';
import { CreateClientAlertDto } from './create-client-alert.dto';

export class UpdateClientAlertDto extends PartialType(CreateClientAlertDto) {}
