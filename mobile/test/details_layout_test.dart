import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexo/domain/entities/assistant.dart';
import 'package:nexo/domain/entities/catalog_item.dart';
import 'package:nexo/domain/repositories/catalog_repository.dart';
import 'package:nexo/features/catalog/catalog_cubit.dart';
import 'package:nexo/features/catalog/content_details_page.dart';

const _long =
    'A long description that keeps going so the synopsis needs a More button. '
    'A long description that keeps going so the synopsis needs a More button. '
    'A long description that keeps going so the synopsis needs a More button. '
    'A long description that keeps going so the synopsis needs a More button. '
    'A long description that keeps going so the synopsis needs a More button. '
    'A long description that keeps going so the synopsis needs a More button.';

class _Repository implements CatalogRepository {
  @override
  Future<CatalogItem?> seriesDetails(String slug) async => const CatalogItem(
      id: 'series-1',
      slug: 'drama',
      name: 'A Drama With A Fairly Long Title',
      category: 'Series',
      type: 'series',
      synopsis: _long,
      genres: ['Drama'],
      year: 2026);

  @override
  Future<List<CatalogSeason>> seasons(String slug) async => [
        CatalogSeason(id: 's1', number: 1, title: 'Season 1', episodes: [
          for (var number = 1; number <= 12; number++)
            CatalogEpisode(
                id: 'e$number',
                number: number,
                title: 'Episode $number',
                synopsis: 'What happens in episode $number.')
        ])
      ];

  @override
  Future<List<CatalogItem>> saved() async => const [];

  @override
  Future<AssistantMessage> askAssistant(List<AssistantMessage> history,
          {String? region, List<String> memory = const []}) async =>
      const AssistantMessage(role: 'assistant', content: '');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> _pump(WidgetTester tester, Size size,
    {double textScale = 1}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(BlocProvider(
      create: (_) => CatalogCubit(_Repository()),
      child: MaterialApp(
          home: MediaQuery(
              data: MediaQueryData(
                  size: size,
                  textScaler: TextScaler.linear(textScale),
                  padding: const EdgeInsets.only(top: 24, bottom: 34)),
              child: const SeriesDetailsPage(slug: 'drama')))));
  await tester.pumpAndSettle();
}

void main() {
  for (final (name, size, scale) in [
    ('small phone', const Size(320, 640), 1.0),
    ('phone with large text', const Size(390, 844), 1.6),
    ('landscape phone', const Size(844, 390), 1.0),
    ('tablet', const Size(1024, 1366), 1.0),
  ]) {
    testWidgets('series details lay out and scroll on a $name', (tester) async {
      await _pump(tester, size, textScale: scale);
      expect(tester.takeException(), isNull);
      expect(find.text('More'), findsOneWidget);
      // The last episode and the rights note can be scrolled into view.
      await tester.scrollUntilVisible(find.text('12. Episode 12'), 300,
          scrollable: find.byType(Scrollable).first);
      await tester.scrollUntilVisible(
          find.textContaining('Availability depends'), 300,
          scrollable: find.byType(Scrollable).first);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('More expands the description', (tester) async {
    await _pump(tester, const Size(390, 844));
    await Scrollable.ensureVisible(tester.element(find.text('More')),
        alignment: .5);
    await tester.pumpAndSettle();
    await tester.tap(find.text('More'));
    await tester.pumpAndSettle();
    expect(find.text('Less'), findsOneWidget);
  });
}
