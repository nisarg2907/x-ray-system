import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Run } from './Run';
import { StepSummary } from './StepSummary';

export type StepType = 'filter' | 'rank' | 'generate' | 'select';

@Entity('steps')
@Index(['run_id'])
@Index(['type'])
@Index(['name'])
export class Step {
  @PrimaryColumn('uuid')
  step_id!: string;

  @Column({ type: 'uuid' })
  run_id!: string;

  @ManyToOne(() => Run, (run) => run.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run?: Run;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: StepType;

  @Column({ type: 'integer', nullable: true })
  input_count?: number;

  @Column({ type: 'integer', nullable: true })
  output_count?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @CreateDateColumn({ type: 'timestamp' })
  created_at!: Date;

  @OneToOne(() => StepSummary, (summary) => summary.step, { cascade: true })
  summary?: StepSummary;
}

