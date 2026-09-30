export function isAvatarUrl(value) {
  return /^(https?:\/\/|\/)/i.test(String(value || '').trim());
}

export default function Avatar({ value, className = '', alt = 'Shop avatar' }) {
  if (isAvatarUrl(value)) {
    return (
      <span className={`overflow-hidden ${className}`}>
        <img src={value} alt={alt} className="h-full w-full object-cover" />
      </span>
    );
  }
  return <span className={className}>{value || '🛍️'}</span>;
}