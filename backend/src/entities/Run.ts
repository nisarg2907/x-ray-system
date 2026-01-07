import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Step } from './Step';

export type RunStatus = 'running' | 'success' | 'error';

@Entity('runs')
@Index(['pipeline'])
@Index(['status'])
@Index(['started_at'])
export class Run {
  @PrimaryColumn('uuid')
  run_id!: string;

  @Column({ type: 'varchar', length: 255 })
  pipeline!: string;

  @Column({ type: 'jsonb', nullable: true })
  input?: any;

  @Column({ type: 'timestamp' })
  started_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  ended_at?: Date;

  @Column({ type: 'varchar', length: 50, default: 'running' })
  status!: RunStatus;

  @CreateDateColumn({ type: 'timestamp' })
  created_at!: Date;

  @OneToMany(() => Step, (step) => step.run)
  steps?: Step[];
}

