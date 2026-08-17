interface BrandLockupProps {
  kind?: 'stream' | 'wordmark';
}

export function BrandLockup({ kind = 'stream' }: BrandLockupProps): React.JSX.Element {
  return (
    <span className={`tvm-lockup tvm-lockup--${kind}`}>
      <span className="tvm-lockup__mark" aria-hidden="true" />
      <span className="tvm-lockup__word">{kind === 'wordmark' ? 'TVM' : 'tvm stream'}</span>
    </span>
  );
}
