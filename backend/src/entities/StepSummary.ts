import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Step } from './Step';

@Entity('step_summaries')
@Index(['rejected', 'accepted'], { unique: false })
export class StepSummary {
  @PrimaryColumn('uuid')
  step_id!: string;

  @OneToOne(() => Step, (step) => step.summary, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'step_id' })
  step?: Step;

  @Column({ type: 'integer', default: 0 })
  rejected!: number;

  @Column({ type: 'integer', default: 0 })
  accepted!: number;

  @Column({ type: 'jsonb', default: {} })
  rejection_breakdown!: Record<string, number>;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at!: Date;
}

