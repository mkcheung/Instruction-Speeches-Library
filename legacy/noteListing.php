<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("topic.php");
require_once("notes.php");
require_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$theTopicId = $_POST['theTopicId'];
$notes = Note::find_notes_by_topic_id($theTopicId);

?>

<table class="table">
	<thead>
		<tr>
			<td>Title</td>
			<td>Note</td>
			<td>Begin</td>
			<td>End</td>
			<td>Actions</td>
		</tr>
	</thead>
	<tbody>
		<?php
			foreach($notes as $note){
		?>
				<tr>
					<td><?=$note->title?></td>
					<td><?=$note->note?></td>
					<td><?=$note->begin_time?></td>
					<td><?=$note->end_time?></td>			
					<td><a id="editNote-<?=$note->id?>" href="editNote.php?noteId=<?=$note->id?>"><button type="button" class="btn btn-info">Edit</button></a>
			     <a id="deleteNote-<?=$note->id?>" href="deleteNote.php?noteId=<?=$note->id?>"><button type="button" class="btn btn-danger">Delete</button></td>
					</tr>		
		<?php	
			}
		?>
	</tbody>
</table>



<script>
	$("#notesListingBlock").unbind();
	$('#notesListingBlock').on("click",'a[id*="editNote"]', function(e){
		e.preventDefault();
		e.stopPropagation();

	//	alert('22');

		id = $(this).attr('id');
		noteIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		$('#annotationBlock').load('editNote.php', {noteId:noteIdValue, topicId:<?=$theTopicId?>});

	});


	$('#notesListingBlock').on("click",'a[id*="deleteNote"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('delete note');

		id = $(this).attr('id');
		noteIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		deleteNoteData(noteIdValue);
	});

	function deleteNoteData(noteIdValue){
		$.ajax({
			type:'POST',
			url: 'noteDelete.php',
			data:{noteid:noteIdValue},
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Note deleted!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#notesListingBlock").load("noteListing.php",{ 'theTopicId': <?=$theTopicId?> });

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Note could not be deleted.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadNotesForm"]')[0].reset();
			}
		});
	};
</script>