type Tempy = typeof import("tempy");
let _tempy: Tempy | null = null;

export const getTempy = async () => {
  if (!_tempy) {
    _tempy = await import("tempy");
  }

  return _tempy;
};
