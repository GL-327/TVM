# Builds the TVM launcher assets from the original artwork (native/assets/tvm-icon.png).
# The white logo is separated from the gradient by linear unmixing (px = a*white + (1-a)*bg),
# so its own anti-aliased edges are kept; nothing is redrawn.
from PIL import Image, ImageFilter; import numpy as np, os
SRC='/home/user/TVM/native/assets/tvm-icon.png'
OUT=os.environ.get('OUT','/tmp/tvm-icons'); os.makedirs(OUT,exist_ok=True)
im=np.asarray(Image.open(SRC).convert('RGB')).astype(np.float64)
H,W,_=im.shape
def F(u,v): return np.stack([np.ones_like(u),u,v,u*u,u*v,v*v,u**3,u*u*v,u*v*v,v**3],-1)
yy,xx=np.mgrid[0:H,0:W]; u=xx/(W-1); v=yy/(H-1)
FF=F(u,v); bgm=im.min(axis=2)<40
coef=[np.linalg.lstsq(FF[bgm],im[...,c][bgm],rcond=None)[0] for c in range(3)]
def grad(n, u0=0,u1=1,v0=0,v1=1):
    y,x=np.mgrid[0:n,0:n]; uu=u0+(u1-u0)*x/(n-1); vv=v0+(v1-v0)*y/(n-1)
    f=F(uu,vv); return np.clip(np.stack([f@coef[c] for c in range(3)],-1),0,255)
bg=np.stack([FF@coef[c] for c in range(3)],-1)
d=255-bg; a=np.clip(((im-bg)*d).sum(-1)/(d*d).sum(-1),0,1)
# Keep only the logo: alpha near solid logo pixels; texture noise elsewhere is dropped.
core=Image.fromarray(((a>0.5)*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))
a=a*(np.asarray(core)>0); a[a<0.015]=0
ys,xs=np.nonzero(a>0.04); x0,x1,y0,y1=xs.min(),xs.max(),ys.min(),ys.max()
cx,cy=(x0+x1)/2,(y0+y1)/2
far=np.sqrt((xs-cx)**2+(ys-cy)**2).max()
print('logo bbox',x0,x1,y0,y1,'centre',cx,cy,'farthest',round(far,1))
A=Image.fromarray((a*255).round().astype(np.uint8))
def placed(n, radius):
    """Logo alpha, scaled without distortion so its farthest point is radius*n from the centre, centred."""
    s=radius*n/far
    big=A.resize((round(W*s*4),round(H*s*4)),Image.LANCZOS)  # supersample, then down
    canvas=Image.new('L',(n*4,n*4),0)
    canvas.paste(big,(round(n*2-cx*s*4),round(n*2-cy*s*4)))
    return canvas.resize((n,n),Image.LANCZOS), s
def rgba(rgb,alpha): return Image.merge('RGBA',[*Image.fromarray(rgb.astype(np.uint8)).split(),alpha])
SAFE=0.30   # adaptive icon: masks always show a circle of radius 33/108 ≈ 0.306 of the layer
MASTER=0.40 # full-bleed square master: generous inner spacing, still large
res={}
# Adaptive layers (108dp; 432 px = xxxhdpi).
fg,_=placed(432,SAFE); white=np.full((432,432,3),255.0)
res['fg']=rgba(white,fg); res['bg']=Image.fromarray(grad(432).astype(np.uint8)); res['mono']=rgba(white,fg)
# Square masters: original gradient, logo re-centred with spacing.
for n in (1024,512):
    al,_=placed(n,MASTER); g=grad(n); al3=np.asarray(al)[...,None]/255.0
    res[f'master{n}']=Image.fromarray((al3*255+(1-al3)*g).round().astype(np.uint8))
# Glass: the logo alone, filled with the TVM gradient across its own width; fully transparent elsewhere.
for n in (1024,512):
    al,s=placed(n,MASTER); arr=np.asarray(al)
    ys2,xs2=np.nonzero(arr>10); gx0,gx1,gy0,gy1=xs2.min(),xs2.max(),ys2.min(),ys2.max()
    y,x=np.mgrid[0:n,0:n]; uu=np.clip((x-gx0)/(gx1-gx0),0,1); vv=np.clip((y-gy0)/(gy1-gy0),0,1)
    f=F(uu,vv); g=np.clip(np.stack([f@coef[c] for c in range(3)],-1),0,255)
    rgb=np.where(arr[...,None]>0,g,0)  # colour only where the logo is; RGB 0 under alpha 0
    res[f'glass{n}']=rgba(rgb,al)
for k,v in res.items(): v.save(f'{OUT}/{k}.png', optimize=True)
print('ok', {k:(v.size,v.mode) for k,v in res.items()})
