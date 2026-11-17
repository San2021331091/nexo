import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/theme.dart';
import '../catalog/catalog_cubit.dart';
import '../live/live_page.dart';
import '../shared/widgets.dart';

/// Saved channels and titles. Stored on this device only; there are no accounts.
class MyListPage extends StatelessWidget {
  const MyListPage({super.key});

  @override
  Widget build(BuildContext context) {
    final saved = context.watch<CatalogCubit>().state.saved;
    return DecoratedBox(
      decoration: const BoxDecoration(gradient: kPageGradient),
      child: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const PageTitle('My List'),
          Expanded(
              child: saved.isEmpty
                  ? const EmptyState(
                      icon: Icons.folder_off_outlined,
                      title: 'Nothing to Show',
                      body:
                          'Save channels, movies and series to find them here. Your list stays on this device and does not sync across devices.')
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 24),
                      itemCount: saved.length,
                      itemBuilder: (context, index) {
                        // Newest first.
                        final item = saved[saved.length - 1 - index];
                        return MediaRow(
                            item: item,
                            trailing: IconButton(
                                tooltip: 'Remove from My List',
                                onPressed: () =>
                                    context.read<CatalogCubit>().toggle(item),
                                icon: const Icon(Icons.bookmark_remove_outlined,
                                    color: kPink)));
                      })),
        ]),
      ),
    );
  }
}
