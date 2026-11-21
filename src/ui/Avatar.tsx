/** Original local block character, independent of any remote skin or copied game asset. */
export function Avatar({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'avatar-small' : 'avatar-character'} viewBox="0 0 180 220" aria-hidden="true" shapeRendering="crispEdges">
    <ellipse cx="90" cy="204" rx="56" ry="8" fill="#284b2e" opacity=".09" />
    <path d="M54 126h72v57H54z" fill="#334b41" /><path d="M54 176h30v25H54zm42 0h30v25H96z" fill="#253d35" />
    <path d="M39 82h102v63H39z" fill="#668d63" /><path d="M54 82h72v63H54z" fill="#83a77a" /><path d="M82 87h16v58H82z" fill="#6d9567" />
    <path d="M39 124h15v24H39zm87 0h15v24h-15z" fill="#d5b697" /><path d="M77 77h26v18H77z" fill="#c29d7f" />
    <path d="M57 22h66v61H57z" fill="#dbbc9c" /><path d="M57 22h66v17H57zm0 17h10v15H57zm56 0h10v15h-10z" fill="#4b493c" />
    <path d="M67 22h38v7H67z" fill="#63604c" /><path d="M68 52h13v7H68zm31 0h13v7H99z" fill="#f5f0df" />
    <path d="M75 52h6v7h-6zm24 0h6v7h-6z" fill="#486256" /><path d="M86 61h8v7h-8z" fill="#c6a184" /><path d="M79 73h22v4H79z" fill="#a27d65" />
    <path d="M54 196h30v8H54zm42 0h30v8H96z" fill="#233a32" />
  </svg>;
}
