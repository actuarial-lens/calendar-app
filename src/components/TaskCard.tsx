import type { Phase } from '../lib/animatedList';
import type { Task } from '../types';
import { REPEAT_LABEL } from '../lib/repeat';
import { SwipeRow, type SwipeAction } from './SwipeRow';

interface Props {
  task: Task;
  phase: Phase;
  open: boolean;
  anyOpen: boolean;
  actions: SwipeAction[];
  onOpenChange: (id: string | null) => void;
  onEdit: () => void;
}

export function TaskCard({ task, phase, open, anyOpen, actions, onOpenChange, onEdit }: Props) {
  return (
    <div className={'collapse ' + phase}>
      <div className="collapse-inner task-slot">
        <SwipeRow
          id={task.id}
          open={open}
          anyOpen={anyOpen}
          actions={actions}
          onOpenChange={onOpenChange}
          onTap={onEdit}
          wrapClass="card-wrap"
          frontClass={'card' + (task.done ? ' done' : '')}
        >
          <div className="row1">
            <div className="left">
              <span className="cat">{task.category}</span>
              {task.repeat && <span className="rep">↻ {REPEAT_LABEL[task.repeat.freq]}</span>}
              {!task.done && task.delayDays > 0 && <span className="delay">延 {task.delayDays} 天</span>}
            </div>
            <span className="time">{task.time}</span>
          </div>
          <span className="title">{task.title}</span>
          {task.note && <span className="note">{task.note}</span>}
        </SwipeRow>
      </div>
    </div>
  );
}
