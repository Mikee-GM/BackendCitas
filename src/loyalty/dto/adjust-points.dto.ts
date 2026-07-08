import { IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AdjustPointsDto {
  @IsInt()
  readonly points: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  readonly description: string;
}
