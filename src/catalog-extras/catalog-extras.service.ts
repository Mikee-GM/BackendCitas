import { Injectable } from '@nestjs/common';
import { CreateCatalogExtraDto } from './dto/create-catalog-extra.dto';
import { UpdateCatalogExtraDto } from './dto/update-catalog-extra.dto';

@Injectable()
export class CatalogExtrasService {
  create(createCatalogExtraDto: CreateCatalogExtraDto) {
    return 'This action adds a new catalogExtra';
  }

  findAll() {
    return `This action returns all catalogExtras`;
  }

  findOne(id: number) {
    return `This action returns a #${id} catalogExtra`;
  }

  update(id: number, updateCatalogExtraDto: UpdateCatalogExtraDto) {
    return `This action updates a #${id} catalogExtra`;
  }

  remove(id: number) {
    return `This action removes a #${id} catalogExtra`;
  }
}
