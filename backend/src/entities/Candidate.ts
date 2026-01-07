import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Step } from './Step';

export type CandidateDecision = 'accepted' | 'rejected';

@Entity('candidates')
@Index(['step_id'])
@Index(['decision'])
export class Candidate {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  candidate_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  step_id!: string;

  @ManyToOne(() => Step, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'step_id' })
  step?: Step;

  @Column({ type: 'varchar', length: 50 })
  decision!: CandidateDecision;

  @Column({ type: 'numeric', nullable: true })
  score?: number;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at!: Date;
}

