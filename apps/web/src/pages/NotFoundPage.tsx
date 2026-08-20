import { Link } from 'react-router-dom';
import { buttonStyles } from '@/components/ui/Button';

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="eyebrow">Error 404</p>
      <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink">
        That page does not exist
      </h1>
      <p className="mt-2 text-sm text-ink-faint">
        The link may be out of date, or the module may not have shipped yet. Check the sidebar for
        what is available.
      </p>
      <Link to="/" className={buttonStyles({ variant: 'primary', className: 'mt-6' })}>
        Back to dashboard
      </Link>
    </div>
  );
}
