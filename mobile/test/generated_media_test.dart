import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexo/domain/entities/assistant.dart';
import 'package:nexo/domain/entities/catalog_item.dart';
import 'package:nexo/domain/repositories/catalog_repository.dart';
import 'package:nexo/features/assistant/generated_media.dart';
import 'package:nexo/features/catalog/catalog_cubit.dart';

class _Repository implements CatalogRepository {
  _Repository(this.states);
  final List<GeneratedVideo> states;
  var calls = 0;

  @override
  Future<GeneratedVideo> generatedVideo(String id) async =>
      states[(calls++).clamp(0, states.length - 1)];

  @override
  Future<List<CatalogItem>> saved() async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('replies carry generated images and video jobs', () {
    final reply = AssistantMessage.fromReply({
      'reply': 'Here you go',
      'media': {
        'images': [
          {'url': 'https://cdn.example/p.png', 'shape': 'poster'},
          {'url': 'javascript:alert(1)'},
          {'url': 'data:image/jpeg;base64,AAAA', 'shape': 'wide'},
        ],
        'videos': [
          {'id': 'video_abc123', 'status': 'queued'},
          {'id': '../bad'},
        ],
      },
    });
    expect(reply.images.map((image) => image.url),
        ['https://cdn.example/p.png', 'data:image/jpeg;base64,AAAA']);
    expect(reply.images.last.aspectRatio, 16 / 9);
    expect(reply.videoIds, ['video_abc123']);

    // Inline images are not kept in the saved chat; links and videos are.
    final stored = AssistantMessage.fromStorage(reply.toStorage())!;
    expect(
        stored.images.map((image) => image.url), ['https://cdn.example/p.png']);
    expect(stored.videoIds, ['video_abc123']);
  });

  testWidgets('a video card shows progress, then a play button',
      (tester) async {
    final repository = _Repository(const [
      GeneratedVideo(id: 'video_1', status: 'running', progress: 40),
      GeneratedVideo(
          id: 'video_1', status: 'done', url: 'https://cdn.example/v.mp4'),
    ]);
    await tester.pumpWidget(BlocProvider(
        create: (_) => CatalogCubit(repository),
        child: const MaterialApp(
            home: Scaffold(body: GeneratedVideoCard(id: 'video_1')))));
    await tester.pump();
    expect(find.text('Making your video… 40%'), findsOneWidget);
    await tester.pump(const Duration(seconds: 7));
    await tester.pump();
    expect(find.byIcon(Icons.play_arrow_rounded), findsOneWidget);
    expect(repository.calls, 2);
  });

  testWidgets('a failed video says so', (tester) async {
    final repository =
        _Repository(const [GeneratedVideo(id: 'video_2', status: 'failed')]);
    await tester.pumpWidget(BlocProvider(
        create: (_) => CatalogCubit(repository),
        child: const MaterialApp(
            home: Scaffold(body: GeneratedVideoCard(id: 'video_2')))));
    await tester.pump();
    expect(find.text('The video could not be made.'), findsOneWidget);
  });
}
