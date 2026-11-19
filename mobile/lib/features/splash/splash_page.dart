import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';

/// A short, animated brand reveal shown while the home feed is prepared.
class SplashPage extends StatefulWidget {
  const SplashPage({super.key});

  @override
  State<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends State<SplashPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animation = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..forward();
  Timer? _openHome;

  @override
  void initState() {
    super.initState();
    _openHome = Timer(const Duration(milliseconds: 1750), () {
      if (mounted) context.go('/');
    });
  }

  @override
  void dispose() {
    _openHome?.cancel();
    _animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: AnimatedBuilder(
        animation: _animation,
        builder: (context, _) {
          final reveal = Curves.easeOutCubic.transform(
            (_animation.value / .65).clamp(0.0, 1.0),
          );
          return Stack(
            fit: StackFit.expand,
            children: [
              const DecoratedBox(
                decoration: BoxDecoration(
                  color: Color(0xFF0D0B13),
                  gradient: RadialGradient(
                    center: Alignment(0, -.2),
                    radius: 1.15,
                    colors: [Color(0xFF24113C), Color(0xFF100D18), Color(0xFF09090D)],
                    stops: [0, .55, 1],
                  ),
                ),
              ),
              CustomPaint(painter: _OrbitPainter(_animation)),
              SafeArea(
                child: Column(
                  children: [
                    const Spacer(flex: 4),
                    Transform.translate(
                      offset: Offset(0, (1 - reveal) * 22),
                      child: Opacity(
                        opacity: reveal,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            _PlayEmblem(progress: _animation.value),
                            const SizedBox(height: 27),
                            const _Wordmark(),
                            const SizedBox(height: 12),
                            Text(
                              'YOUR NEXT FAVORITE STARTS HERE',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: .62),
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                letterSpacing: 2.6,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const Spacer(flex: 3),
                    Opacity(
                      opacity: reveal,
                      child: Column(
                        children: [
                          const Text(
                            'LIVE TV     •     MOVIES     •     SERIES',
                            style: TextStyle(
                              color: Color(0xFFBDB5C9),
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                              letterSpacing: 1.2,
                            ),
                          ),
                          const SizedBox(height: 22),
                          _LoadingMark(progress: _animation.value),
                          const SizedBox(height: 24),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _PlayEmblem extends StatelessWidget {
  const _PlayEmblem({required this.progress});
  final double progress;

  @override
  Widget build(BuildContext context) {
    final scale = .82 + .18 * Curves.easeOutBack.transform(
      (progress / .72).clamp(0.0, 1.0),
    );
    return Transform.scale(
      scale: scale,
      child: SizedBox(
        width: 176,
        height: 176,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Container(
              width: 150,
              height: 150,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF39214E), Color(0xFF17121F)],
                ),
                border: Border.all(color: Colors.white.withValues(alpha: .12)),
                boxShadow: const [
                  BoxShadow(color: Color(0x55FF2E86), blurRadius: 54, spreadRadius: 2),
                  BoxShadow(color: Color(0x554F65FF), blurRadius: 70, spreadRadius: 5),
                  BoxShadow(color: Color(0xAA050408), blurRadius: 25, offset: Offset(0, 16)),
                ],
              ),
            ),
            Container(
              width: 91,
              height: 91,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFFFF69AA), Color(0xFFFF2E86), Color(0xFFCF1765)],
                ),
                boxShadow: [
                  BoxShadow(color: kPink.withValues(alpha: .5), blurRadius: 30),
                ],
              ),
              child: const Icon(Icons.play_arrow_rounded,
                  size: 58, color: Colors.white),
            ),
            Positioned(
              top: 20,
              right: 27,
              child: Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .85),
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(color: Colors.white.withValues(alpha: .7), blurRadius: 12),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) => RichText(
        text: const TextSpan(
          style: TextStyle(
            fontFamily: 'Roboto',
            fontSize: 46,
            fontWeight: FontWeight.w900,
            height: 1,
            letterSpacing: 8,
          ),
          children: [
            TextSpan(text: 'NE', style: TextStyle(color: Colors.white)),
            TextSpan(text: 'X', style: TextStyle(color: kPink)),
            TextSpan(text: 'O', style: TextStyle(color: Colors.white)),
          ],
        ),
      );
}

class _LoadingMark extends StatelessWidget {
  const _LoadingMark({required this.progress});
  final double progress;

  @override
  Widget build(BuildContext context) {
    final lit = (progress * 4).floor() % 3;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(3, (index) {
        final active = index == lit;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          margin: const EdgeInsets.symmetric(horizontal: 4),
          width: active ? 19 : 5,
          height: 5,
          decoration: BoxDecoration(
            color: active ? kPink : Colors.white.withValues(alpha: .28),
            borderRadius: BorderRadius.circular(9),
            boxShadow: active
                ? [BoxShadow(color: kPink.withValues(alpha: .6), blurRadius: 10)]
                : null,
          ),
        );
      }),
    );
  }
}

class _OrbitPainter extends CustomPainter {
  _OrbitPainter(this.animation) : super(repaint: animation);
  final Animation<double> animation;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height * .43);
    final shortest = math.min(size.width, size.height);
    final rotation = animation.value * math.pi * 2;

    // Soft pools of color give the dark canvas depth without an image asset.
    final glow = Paint()..maskFilter = const MaskFilter.blur(BlurStyle.normal, 46);
    glow.color = const Color(0x333D71FF);
    canvas.drawCircle(Offset(center.dx - shortest * .34, center.dy + 70), shortest * .16, glow);
    glow.color = const Color(0x33FF2E86);
    canvas.drawCircle(Offset(center.dx + shortest * .33, center.dy - 20), shortest * .17, glow);

    for (var i = 0; i < 3; i++) {
      canvas.save();
      canvas.translate(center.dx, center.dy);
      canvas.rotate((i.isEven ? 1 : -1) * (rotation * .06 + i * .63));
      final rect = Rect.fromCenter(
        center: Offset.zero,
        width: shortest * (.79 + i * .085),
        height: shortest * (.28 + i * .055),
      );
      final orbit = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = i == 1 ? 1.3 : .8
        ..shader = LinearGradient(
          colors: [
            Colors.transparent,
            const Color(0x55FF2E86),
            const Color(0x99A57BFF),
            Colors.transparent,
          ],
          stops: const [0, .3, .68, 1],
        ).createShader(rect);
      canvas.drawOval(rect, orbit);

      final angle = rotation * (i.isEven ? 1 : -1) + i * 1.9;
      final dot = Offset(math.cos(angle) * rect.width / 2,
          math.sin(angle) * rect.height / 2);
      final dotPaint = Paint()
        ..color = i == 1 ? const Color(0xFFFF5C9F) : const Color(0xFFB99CFF)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5);
      canvas.drawCircle(dot, 3.2, dotPaint);
      canvas.drawCircle(dot, 1.5, Paint()..color = Colors.white);
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _OrbitPainter oldDelegate) =>
      oldDelegate.animation != animation;
}
