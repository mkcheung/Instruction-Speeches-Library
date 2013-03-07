<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("topic.php");
require_once("notes.php");
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$notes = Note::find_all();
?>

<table>
	<thead>
		<tr>
			<td>Title</td>
			<td>Note</td>
			<td>Created</td>
			<td>Modified</td>
			<td>Actions</td>
		</tr>
	</thead>
	<tbody>
		<?php
			foreach($notes as $note){
				echo "<tr>";
					echo "<td>" . $note->title . "</td>";
					echo "<td>" . $note->note . "</td>";
					echo "<td>" . $note->created . "</td>";
					echo "<td>" . $note->modified . "</td>";			
					echo "<td><a id=\"editNote-" . $note->id . "\" href=\"editNote.php?noteId=" . $note->id . "\"><button type=\"button\" class=\"btn btn-warning\">Edit</button></a>" . ' ' . 
			     "<a id=\"deleteNote-" . $note->id . "\" href=\"deleteNote.php?noteId=" . $note->id . "\"><button type=\"button\" class=\"btn btn-danger\">Delete</button>". "</td>";
					echo "</tr>";			
			}
		?>
	</tbody>
</table>

<?php
include_once("footer.php");
?>


<script>
	$("#notesListingBlock").unbind();
	$('#notesListingBlock').on("click",'a[id*="editNote"]', function(e){
		e.preventDefault();
		e.stopPropagation();

	//	alert('22');

		id = $(this).attr('id');
		noteIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		$('#addEditNotesBlock').load('editNote.php', {noteId:noteIdValue});

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
				$("#registerErrorMessages").append('<div class="alert alert-success">Success!</div>');
				$("#settingsControls").load("noteALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Ajax problems.</div>');
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadNotesForm"]')[0].reset();
			}
		});
	};
</script>