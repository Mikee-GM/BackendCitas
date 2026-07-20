import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Empleadas } from './employee.entity';

export type EmployeeRatingSource = 'chofer' | 'jefe';

@Index('idx_employee_ratings_employee_source', ['employeeId', 'source'])
@Entity('employee_ratings', { schema: 'public' })
export class EmployeeRating {
  @Column('uuid', { primary: true, default: () => 'gen_random_uuid()' })
  id: string;

  @Column('uuid', { name: 'employee_id' })
  employeeId: string;

  @Column('enum', { name: 'source', enum: ['chofer', 'jefe'] })
  source: EmployeeRatingSource;

  @Column('uuid', { name: 'rater_user_id', nullable: true })
  raterUserId: string | null;

  @Column('uuid', { name: 'reference_id', nullable: true })
  referenceId: string | null;

  @Column('smallint')
  rating: number;

  @Column('text', { nullable: true })
  comment: string | null;

  @Column('timestamp with time zone', { name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => Empleadas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id', referencedColumnName: 'id' })
  employee: Empleadas;
}
